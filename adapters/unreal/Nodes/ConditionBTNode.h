#pragma once
#include "BTNode.h"

UCLASS()
class UConditionBTNode : public UBTNode
{
	GENERATED_BODY()
public:
	TFunction<bool(UBlackboard*)> Check;

protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		return (Check && Check(Bb)) ? EBTNodeStatus::Success : EBTNodeStatus::Failure;
	}
};
