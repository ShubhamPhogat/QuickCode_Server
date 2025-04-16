# User code

# User's solution function
def solve(a, b):
    # User's implementation goes here
    return a + b



# Test runner
def run_tests():
    passed = True
    input0 = [1,2,3]
    input1 = [4,5,6]
    expected = 5
    actual = solve(input0, input1)
    if actual != expected:
        print(f"Test case 0 failed. Expected {expected} got {actual}")
        passed = False

    input0 = [10,20]
    input1 = [30,40]
    expected = 40
    actual = solve(input0, input1)
    if actual != expected:
        print(f"Test case 1 failed. Expected {expected} got {actual}")
        passed = False

    if passed:
        print("All test cases passed")
    return passed

if __name__ == "__main__":
    run_tests()